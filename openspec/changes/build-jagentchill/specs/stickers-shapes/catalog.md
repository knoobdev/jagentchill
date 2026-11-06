# stickers-shapes — normative catalogue

This file is normative for `stickers-shapes` (cited by the requirement "Starter sticker pack"). It enumerates the bundled pack "Starter": 128 stickers in 8 categories, 16 per category, of which 4 per category (32 in total) are animated. Every sticker is drawn for JAgentChill, is dedicated to the public domain under CC0-1.0, and contains no brand mark, logo, or name or interface artwork of a third-party product or service. Ids are stable; the sticker id used in projects is `starter:<id>`.

Formats. Static: SVG, viewBox `0 0 512 512`, no scripts, no external references, no embedded raster. Animated: animated WebP, 512×512 px, 24 frames per second, at most 300 kB, with the loop duration given below (the last frame continues into the first).

Source and licence. Each file lives at `packages/content/stickers/starter/<category-dir>/<id>.svg` (static) or `<id>.webp` (animated) together with its authoring source (`<id>.src.svg`); that path is the `source` of the manifest entry, the `licence` is `CC0-1.0` for every row, and the directory has one row in the asset provenance file of `platform-skeleton.Licence and third-party notices`. The manifest `packages/content/stickers/starter/manifest.json` carries for every id `{id, title, category, type, duration?, licence, source, keywords {en[], vi[], ja[]}}`, where each keyword list contains at least the title in that language; the build check compares the manifest and the files with this catalogue in both directions.

## Arrows (directory `arrows`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 1 | `arrow-right` | Arrow right | static | — |
| 2 | `arrow-left` | Arrow left | static | — |
| 3 | `arrow-up` | Arrow up | static | — |
| 4 | `arrow-down` | Arrow down | static | — |
| 5 | `arrow-curved-right` | Curved arrow right | static | — |
| 6 | `arrow-curved-left` | Curved arrow left | static | — |
| 7 | `arrow-loop` | Loop arrow | static | — |
| 8 | `arrow-zigzag` | Zigzag arrow | static | — |
| 9 | `arrow-double` | Double-headed arrow | static | — |
| 10 | `pointer-hand` | Pointing hand | static | — |
| 11 | `cursor-click` | Cursor with click marks | static | — |
| 12 | `target-ring` | Target ring | static | — |
| 13 | `arrow-bounce` | Bouncing arrow | animated | 1.0 s |
| 14 | `arrow-draw-on` | Arrow drawing on | animated | 1.2 s |
| 15 | `pointer-tap` | Tapping finger | animated | 1.0 s |
| 16 | `target-pulse` | Pulsing target | animated | 1.5 s |

## Labels (directory `labels`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 17 | `tag-sale` | Sale tag | static | — |
| 18 | `tag-new` | New tag | static | — |
| 19 | `tag-free` | Free tag | static | — |
| 20 | `badge-one` | Number badge 1 | static | — |
| 21 | `badge-two` | Number badge 2 | static | — |
| 22 | `badge-three` | Number badge 3 | static | — |
| 23 | `label-tip` | Tip label | static | — |
| 24 | `label-note` | Note label | static | — |
| 25 | `label-before` | Before label | static | — |
| 26 | `label-after` | After label | static | — |
| 27 | `ribbon-best` | Best ribbon | static | — |
| 28 | `stamp-approved` | Approved stamp | static | — |
| 29 | `label-wow` | Wow label popping | animated | 1.0 s |
| 30 | `label-new-flash` | Flashing new label | animated | 1.2 s |
| 31 | `stamp-drop` | Stamp dropping | animated | 0.8 s |
| 32 | `badge-spin` | Spinning badge | animated | 2.0 s |

## Social (directory `social`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 33 | `heart-like` | Heart | static | — |
| 34 | `thumb-up` | Thumb up | static | — |
| 35 | `comment-bubble` | Comment bubble | static | — |
| 36 | `share-arrow` | Share arrow | static | — |
| 37 | `bell` | Bell | static | — |
| 38 | `bookmark` | Bookmark | static | — |
| 39 | `button-follow` | Follow button | static | — |
| 40 | `button-subscribe` | Subscribe button | static | — |
| 41 | `button-play` | Play button | static | — |
| 42 | `badge-live` | Live badge | static | — |
| 43 | `stars-five` | Five stars | static | — |
| 44 | `at-sign` | At sign | static | — |
| 45 | `heart-burst` | Bursting heart | animated | 1.0 s |
| 46 | `bell-ring` | Ringing bell | animated | 1.0 s |
| 47 | `thumb-bounce` | Bouncing thumb up | animated | 1.0 s |
| 48 | `live-pulse` | Pulsing live badge | animated | 1.5 s |

## Celebration (directory `celebration`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 49 | `balloon` | Balloon | static | — |
| 50 | `balloons-three` | Three balloons | static | — |
| 51 | `party-popper` | Party popper | static | — |
| 52 | `confetti-burst` | Confetti burst | static | — |
| 53 | `gift-box` | Gift box | static | — |
| 54 | `cake` | Cake | static | — |
| 55 | `trophy` | Trophy | static | — |
| 56 | `medal` | Medal | static | — |
| 57 | `crown` | Crown | static | — |
| 58 | `sparkle-stars` | Sparkle stars | static | — |
| 59 | `fireworks-still` | Fireworks | static | — |
| 60 | `banner-congrats` | Congratulations banner | static | — |
| 61 | `confetti-fall` | Falling confetti | animated | 2.0 s |
| 62 | `fireworks` | Fireworks bursting | animated | 1.6 s |
| 63 | `sparkle-twinkle` | Twinkling sparkles | animated | 1.2 s |
| 64 | `balloon-float` | Floating balloon | animated | 2.0 s |

## Nature (directory `nature`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 65 | `sun` | Sun | static | — |
| 66 | `moon` | Moon | static | — |
| 67 | `cloud` | Cloud | static | — |
| 68 | `rainbow` | Rainbow | static | — |
| 69 | `leaf` | Leaf | static | — |
| 70 | `flower` | Flower | static | — |
| 71 | `tree` | Tree | static | — |
| 72 | `mountain` | Mountain | static | — |
| 73 | `wave` | Wave | static | — |
| 74 | `snowflake` | Snowflake | static | — |
| 75 | `raindrop` | Raindrop | static | — |
| 76 | `flame` | Flame | static | — |
| 77 | `sun-spin` | Spinning sun | animated | 2.0 s |
| 78 | `rain-fall` | Falling rain | animated | 1.0 s |
| 79 | `snow-fall` | Falling snow | animated | 2.0 s |
| 80 | `leaf-sway` | Swaying leaf | animated | 1.6 s |

## Objects (directory `objects`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 81 | `camera` | Camera | static | — |
| 82 | `clapperboard` | Clapperboard | static | — |
| 83 | `microphone` | Microphone | static | — |
| 84 | `headphones` | Headphones | static | — |
| 85 | `light-bulb` | Light bulb | static | — |
| 86 | `coffee-cup` | Coffee cup | static | — |
| 87 | `clock` | Clock | static | — |
| 88 | `calendar` | Calendar | static | — |
| 89 | `map-pin` | Map pin | static | — |
| 90 | `paper-plane` | Paper plane | static | — |
| 91 | `magnifier` | Magnifier | static | — |
| 92 | `padlock` | Padlock | static | — |
| 93 | `light-bulb-on` | Light bulb turning on | animated | 1.0 s |
| 94 | `clock-tick` | Ticking clock | animated | 2.0 s |
| 95 | `paper-plane-fly` | Flying paper plane | animated | 1.5 s |
| 96 | `camera-flash` | Camera flash | animated | 0.8 s |

## Frames (directory `frames`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 97 | `frame-instant-photo` | Instant photo frame | static | — |
| 98 | `frame-film-strip` | Film strip frame | static | — |
| 99 | `frame-rounded` | Rounded frame | static | — |
| 100 | `frame-circle` | Circle frame | static | — |
| 101 | `frame-corner-marks` | Corner marks | static | — |
| 102 | `frame-brush` | Brush frame | static | — |
| 103 | `frame-tape` | Taped frame | static | — |
| 104 | `frame-ticket` | Ticket frame | static | — |
| 105 | `frame-speech` | Speech frame | static | — |
| 106 | `frame-window` | Window frame | static | — |
| 107 | `frame-dotted` | Dotted frame | static | — |
| 108 | `frame-double` | Double-line frame | static | — |
| 109 | `frame-recording` | Recording frame with blinking dot | animated | 1.0 s |
| 110 | `frame-focus` | Focus brackets closing in | animated | 1.2 s |
| 111 | `frame-marching-dots` | Marching dots frame | animated | 1.0 s |
| 112 | `frame-glow` | Glowing frame | animated | 2.0 s |

## Hand-drawn (directory `hand-drawn`)

| # | id | Title | Type | Loop duration |
|---|---|---|---|---|
| 113 | `doodle-circle` | Doodle circle | static | — |
| 114 | `doodle-underline` | Doodle underline | static | — |
| 115 | `doodle-arrow` | Doodle arrow | static | — |
| 116 | `doodle-star` | Doodle star | static | — |
| 117 | `doodle-heart` | Doodle heart | static | — |
| 118 | `doodle-check` | Doodle check mark | static | — |
| 119 | `doodle-cross` | Doodle cross | static | — |
| 120 | `doodle-exclaim` | Doodle exclamation mark | static | — |
| 121 | `doodle-question` | Doodle question mark | static | — |
| 122 | `doodle-swirl` | Doodle swirl | static | — |
| 123 | `doodle-sparkles` | Doodle sparkles | static | — |
| 124 | `doodle-crown` | Doodle crown | static | — |
| 125 | `doodle-circle-draw` | Circle drawing on | animated | 0.8 s |
| 126 | `doodle-underline-draw` | Underline drawing on | animated | 0.6 s |
| 127 | `doodle-scribble` | Scribble | animated | 1.0 s |
| 128 | `doodle-heart-beat` | Beating doodle heart | animated | 1.0 s |
