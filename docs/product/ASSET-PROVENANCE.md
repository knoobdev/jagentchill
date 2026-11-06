# Asset provenance

Every picture, sound and font the app ships, with where it came from. An asset that is not listed here is not shipped.

## Library sample pictures (Effects, Filters and Transitions tabs)

| File | Size | Used for | Origin | Licence |
|---|---|---|---|---|
| `apps/app/public/fx/sample.png` | 320 × 320 | The picture every effect and filter tile is rendered from (`visual-effects-filters.Effects and filters panels`) | Drawn for this project by `apps/app/scripts/gen-fx-samples.mjs`: canvas gradients, ellipses and rectangles only | Project-owned |
| `apps/app/public/fx/transition-a.png` | 480 × 320 | The outgoing sample frame, labelled A, of every transition tile (`transitions.Transition library panel`) | Drawn for this project by the same script: a gradient, stripes and the letter A | Project-owned |
| `apps/app/public/fx/transition-b.png` | 480 × 320 | The incoming sample frame, labelled B | Drawn for this project by the same script: a gradient, stripes and the letter B | Project-owned |

The three files are reproduced by `node apps/app/scripts/gen-fx-samples.mjs`. No outside picture, photograph or third-party preset is used; the classic `public/effects/preview.jpg` is not shipped.

## Template demo media and the covers and previews of the bundled templates

| File | Size | Used for | Origin | Licence |
|---|---|---|---|---|
| `packages/content/templates/demo/*.mp4` (11 clips) and `*.jpg` (12 stills), listed in `demo.json` | 1280 × 720, clips 6 s H.264 without sound | Only to render the covers and previews of the twelve bundled templates (`templates.Bundled templates are original content`); never offered as media and never part of a project | Generated in-house by `packages/content/scripts/make-demo-media.mjs`: every frame is drawn on a 2D canvas from the scene functions in that script (gradients, discs, paths, a seeded random generator) and encoded with ffmpeg | Project-owned, CC0-1.0, author "JAgentChill project" |
| `packages/content/templates/<id>/cover.jpg` and `preview.mp4` (twelve templates), copied to `apps/app/public/templates/<id>/` | 720 px on the long side; previews 6–24 s without sound | The picture and the preview video of each bundled template card (`templates.Template gallery`) | Rendered by the app itself with `packages/content/scripts/render-template-covers.mjs`: the template filled with the demo media above and exported by the app's own export; the cover is one frame of that export | Project-owned, CC0-1.0 |

The demo media is reproduced by `node packages/content/scripts/make-demo-media.mjs`, the covers and previews by `node packages/content/scripts/render-template-covers.mjs` against a served production build; `node packages/content/scripts/check-template-covers.mjs` and the `editor-core` tests check the shipped files. No photograph, footage, music or third-party artwork is used. The bundled templates ship no music yet.
