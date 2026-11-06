# captions-subtitles — normative catalogue

This file is normative for `captions-subtitles` (cited by the requirements "Caption style templates" and "Auto lyrics"). Every style is authored for JAgentChill, uses only the bundled fonts of `text-and-titles/catalog.md` section 1 and the text animations of its section 4, and is shipped as data in `packages/editor-core/src/content/captions/`; a unit test compares the data cell by cell with this table. Ids are stable.

Conventions (identical to `text-and-titles/catalog.md`): `fontSize` is the text parameter (rendered size = `fontSize × canvasHeight / 90`); stroke = `colour width position` (width in % of rendered font size); shadow = `colour opacity blur distance angle`; glow = `colour intensity radius`; background = `colour cornerRadius` with the default paddings; "—" = disabled. Layout = `anchor / marginY / maxWidth` in the units of the requirement "Caption default style and layout"; all styles are center-aligned. Highlight = `highlight.style` followed by `highlight.color` and, where used, `highlight.textColor` or `highlight.scale`. Animation = text animation ids with duration in seconds, applied to every caption.

## Caption styles (24)

| # | id | Name | Font, weight, case | `fontSize` | Fill | Stroke | Shadow | Glow | Background | Layout | Highlight | Animation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `classic` | Classic | Arial 700 | 5 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 5 / 80 | none | — |
| 2 | `classic-yellow` | Classic yellow | Arial 700 | 5 | `#ffd400` | `#000000` 6 outside | — | — | — | bottom / 5 / 80 | none | — |
| 3 | `boxed` | Boxed | Arial 400 | 5 | `#ffffff` | — | — | — | `#000000b3` 20 | bottom / 5 / 80 | none | — |
| 4 | `boxed-light` | Boxed light | Arial 700 | 5 | `#111111` | — | — | — | `#ffffffe6` 20 | bottom / 5 / 80 | none | — |
| 5 | `shadowed` | Shadowed | Arial 700 | 5 | `#ffffff` | — | `#000000` 80 10 5 −45 | — | — | bottom / 5 / 80 | none | — |
| 6 | `film` | Film | Times New Roman 400 italic | 5 | `#fff8e7` | — | `#000000` 70 12 4 −60 | — | — | bottom / 7 / 70 | none | `in-fade` 0.2, `out-fade` 0.2 |
| 7 | `terminal` | Terminal | Courier New 700 | 4.5 | `#34c759` | — | — | — | `#000000cc` 0 | bottom / 5 / 80 | reveal `#34c759` | — |
| 8 | `pop-yellow` | Word pop yellow | Arial 700, upper | 6 | `#ffffff` | `#000000` 8 outside | — | — | — | middle / 0 / 70 | color `#ffd400` | `in-pop` 0.2 |
| 9 | `pop-green` | Word pop green | Arial 700, upper | 6 | `#ffffff` | `#000000` 8 outside | — | — | — | middle / 0 / 70 | color `#34c759` | `in-pop` 0.2 |
| 10 | `box-pink` | Word box pink | Arial 700 | 6 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 12 / 80 | background `#ff2d92`, text `#ffffff` | — |
| 11 | `box-blue` | Word box blue | Arial 700 | 6 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 12 / 80 | background `#1e6bff`, text `#ffffff` | — |
| 12 | `box-yellow` | Word box yellow | Arial 700 | 6 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 12 / 80 | background `#ffd400`, text `#000000` | — |
| 13 | `punch` | Punch | Arial 700, upper | 6 | `#ffffff` | `#000000` 10 outside | `#000000` 100 0 8 −45 | — | — | middle / 0 / 70 | scale 1.25, colour `#ffffff` | — |
| 14 | `underline` | Underline | Arial 700 | 5 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 5 / 80 | underline `#ffd400` | — |
| 15 | `karaoke-blue` | Karaoke blue | Arial 700 | 5.5 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 8 / 80 | karaoke `#009dff` | — |
| 16 | `karaoke-pink` | Karaoke pink | Arial 700 | 5.5 | `#ffffff` | `#000000` 6 outside | — | — | — | bottom / 8 / 80 | karaoke `#ff2d92` | — |
| 17 | `lyrics` | Lyrics | Georgia 700 italic | 6 | `#ffffff` | — | `#000000` 60 20 6 −45 | — | — | bottom / 12 / 80 | karaoke `#ffd400` | `in-fade` 0.2, `out-fade` 0.2 |
| 18 | `reveal` | Reveal | Arial 700 | 6 | `#ffffff` | `#000000` 8 outside | — | — | — | bottom / 10 / 80 | reveal `#ffffff` | — |
| 19 | `big-word` | Big word | Arial 700, upper | 9 | `#ffffff` | `#000000` 10 outside | — | — | — | middle / 0 / 90 | none | `in-zoom-out` 0.2 |
| 20 | `neon-night` | Neon night | sans-serif 700 | 5.5 | `#e6f4ff` | — | — | `#009dff` 80 30 | — | bottom / 8 / 80 | color `#ffffff` | — |
| 21 | `soft-pill` | Soft pill | Arial 700 | 4.5 | `#111111` | — | — | — | `#ffffff` 100 | bottom / 6 / 70 | none | `in-rise` 0.2 |
| 22 | `dark-pill` | Dark pill | Arial 700 | 4.5 | `#ffffff` | — | — | — | `#111111` 100 | bottom / 6 / 70 | none | `in-rise` 0.2 |
| 23 | `news-bar` | News bar | Arial 700 | 4.5 | `#ffffff` | — | — | — | `#c8102e` 0 | bottom / 4 / 100 | none | `in-wipe-right` 0.2 |
| 24 | `minimal` | Minimal | Arial 400 | 4 | `#ffffff` | — | `#000000` 60 8 3 −90 | — | — | bottom / 4 / 80 | none | — |

The style applied to a newly generated or imported caption track is `classic` (it equals the default of the requirement "Caption default style and layout"); Lyrics mode applies `lyrics`.
