# projects — normative catalogue

This file is normative for `projects.Background colour and gradient` and `projects.Cover editor`. Every list is
JAgentChill-authored data shipped in `packages/editor-core`; no OpenCut classic preset file
(`syntax-ui`, `pattern-craft`) and no third-party preset collection is copied. Ids are stable and are what project
documents, templates and agent tools store.

## 1. Solid swatches (24)

Shown in this order, 8 per row. The swatch `none` (transparent) is rendered before them and is defined in
`projects.Transparent background`.

| id | Name | Hex |
|---|---|---|
| `sw-black` | Black | `#000000` |
| `sw-charcoal` | Charcoal | `#1C1C1E` |
| `sw-graphite` | Graphite | `#3A3A3C` |
| `sw-grey` | Grey | `#8E8E93` |
| `sw-silver` | Silver | `#C7C7CC` |
| `sw-cloud` | Cloud | `#F2F2F7` |
| `sw-white` | White | `#FFFFFF` |
| `sw-cream` | Cream | `#FFF4E0` |
| `sw-red` | Red | `#E5383B` |
| `sw-coral` | Coral | `#FF6B5E` |
| `sw-orange` | Orange | `#FF9500` |
| `sw-amber` | Amber | `#FFB703` |
| `sw-yellow` | Yellow | `#FFD60A` |
| `sw-lime` | Lime | `#A7C957` |
| `sw-green` | Green | `#2FA36B` |
| `sw-teal` | Teal | `#1B9AAA` |
| `sw-cyan` | Cyan | `#48CAE4` |
| `sw-sky` | Sky | `#4EA8FF` |
| `sw-blue` | Blue | `#2563EB` |
| `sw-navy` | Navy | `#14213D` |
| `sw-indigo` | Indigo | `#5E60CE` |
| `sw-purple` | Purple | `#9D4EDD` |
| `sw-pink` | Pink | `#FF5D8F` |
| `sw-brown` | Brown | `#7F5539` |

## 2. Collection "Gradients" (16)

Two- or three-stop linear or radial gradients. `css` is the exact stored string.

| id | Name | css |
|---|---|---|
| `gr-dusk` | Dusk | `linear-gradient(180deg, #14213D 0%, #5E60CE 100%)` |
| `gr-sunrise` | Sunrise | `linear-gradient(180deg, #FFB703 0%, #FF6B5E 100%)` |
| `gr-ocean` | Ocean | `linear-gradient(135deg, #1B9AAA 0%, #2563EB 100%)` |
| `gr-forest` | Forest | `linear-gradient(135deg, #2FA36B 0%, #14213D 100%)` |
| `gr-candy` | Candy | `linear-gradient(90deg, #FF5D8F 0%, #9D4EDD 100%)` |
| `gr-ember` | Ember | `linear-gradient(45deg, #E5383B 0%, #FF9500 100%)` |
| `gr-mint` | Mint | `linear-gradient(90deg, #A7C957 0%, #48CAE4 100%)` |
| `gr-slate` | Slate | `linear-gradient(180deg, #3A3A3C 0%, #000000 100%)` |
| `gr-paper` | Paper | `linear-gradient(180deg, #FFFFFF 0%, #C7C7CC 100%)` |
| `gr-aurora` | Aurora | `linear-gradient(120deg, #2FA36B 0%, #48CAE4 50%, #9D4EDD 100%)` |
| `gr-sunset` | Sunset | `linear-gradient(180deg, #5E60CE 0%, #FF5D8F 50%, #FFB703 100%)` |
| `gr-peach` | Peach | `linear-gradient(135deg, #FFF4E0 0%, #FF6B5E 100%)` |
| `gr-spot-light` | Spotlight | `radial-gradient(circle at 50% 50%, #3A3A3C 0%, #000000 100%)` |
| `gr-spot-warm` | Warm glow | `radial-gradient(circle at 50% 40%, #FFD60A 0%, #FF9500 60%, #E5383B 100%)` |
| `gr-spot-cool` | Cool glow | `radial-gradient(ellipse at 50% 50%, #48CAE4 0%, #14213D 100%)` |
| `gr-vignette` | Soft vignette | `radial-gradient(ellipse at 50% 50%, #F2F2F7 0%, #8E8E93 100%)` |

## 3. Collection "Patterns" (16)

Layered and repeating CSS gradients. Layers are painted last-to-first; the last layer is a solid fill.

| id | Name | css |
|---|---|---|
| `pt-stripes-diag` | Diagonal stripes | `repeating-linear-gradient(45deg, #2563EB 0px, #2563EB 24px, #14213D 24px, #14213D 48px)` |
| `pt-stripes-h` | Horizontal stripes | `repeating-linear-gradient(0deg, #FFF4E0 0px, #FFF4E0 32px, #FFB703 32px, #FFB703 64px)` |
| `pt-stripes-v` | Vertical stripes | `repeating-linear-gradient(90deg, #1C1C1E 0px, #1C1C1E 40px, #3A3A3C 40px, #3A3A3C 80px)` |
| `pt-pinstripe` | Pinstripe | `repeating-linear-gradient(90deg, #C7C7CC 0px, #C7C7CC 2px, #14213D 2px, #14213D 32px)` |
| `pt-grid` | Grid | `repeating-linear-gradient(0deg, #3A3A3C 0px, #3A3A3C 2px, transparent 2px, transparent 64px), repeating-linear-gradient(90deg, #3A3A3C 0px, #3A3A3C 2px, transparent 2px, transparent 64px), #1C1C1E` |
| `pt-grid-light` | Light grid | `repeating-linear-gradient(0deg, #C7C7CC 0px, #C7C7CC 1px, transparent 1px, transparent 48px), repeating-linear-gradient(90deg, #C7C7CC 0px, #C7C7CC 1px, transparent 1px, transparent 48px), #FFFFFF` |
| `pt-dots` | Dots | `repeating-radial-gradient(circle at 24px 24px, #FF5D8F 0px, #FF5D8F 8px, transparent 8px, transparent 48px), #FFF4E0` |
| `pt-rings` | Rings | `repeating-radial-gradient(circle at 50% 50%, #48CAE4 0px, #48CAE4 16px, #14213D 16px, #14213D 32px)` |
| `pt-checker-soft` | Soft plaid | `repeating-linear-gradient(0deg, rgba(37,99,235,0.35) 0px, rgba(37,99,235,0.35) 40px, transparent 40px, transparent 80px), repeating-linear-gradient(90deg, rgba(37,99,235,0.35) 0px, rgba(37,99,235,0.35) 40px, transparent 40px, transparent 80px), #F2F2F7` |
| `pt-sunburst` | Sunburst bands | `repeating-radial-gradient(circle at 50% 100%, #FFB703 0px, #FFB703 40px, #FF9500 40px, #FF9500 80px)` |
| `pt-horizon` | Horizon | `linear-gradient(180deg, transparent 0%, transparent 60%, #14213D 60%, #14213D 100%), linear-gradient(180deg, #48CAE4 0%, #FFF4E0 100%)` |
| `pt-spot-pair` | Twin spots | `radial-gradient(circle at 20% 30%, rgba(255,93,143,0.8) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(72,202,228,0.8) 0%, transparent 40%), #14213D` |
| `pt-glow-corner` | Corner glow | `radial-gradient(circle at 0% 0%, rgba(255,214,10,0.9) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(157,78,221,0.9) 0%, transparent 50%), #1C1C1E` |
| `pt-scanlines` | Scanlines | `repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 6px), linear-gradient(180deg, #1B9AAA 0%, #14213D 100%)` |
| `pt-blueprint` | Blueprint | `repeating-linear-gradient(0deg, rgba(255,255,255,0.25) 0px, rgba(255,255,255,0.25) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0px, rgba(255,255,255,0.25) 1px, transparent 1px, transparent 40px), #2563EB` |
| `pt-candy-cane` | Candy stripes | `repeating-linear-gradient(135deg, #E5383B 0px, #E5383B 28px, #FFFFFF 28px, #FFFFFF 56px)` |

Lengths in `px` follow `render-engine.Background gradient parsing`: they are authored at a 1920-px canvas long side and
multiplied by the pixel scale factor (`longSide / 1920`). The keyword `transparent` is `rgba(0, 0, 0, 0)` and stops
interpolate in premultiplied sRGB, as that requirement defines.

## 4. Cover text layouts (6)

Positions are fractions of the cover size (origin top-left, anchor = box centre). `size` is the font size as a
fraction of the cover height. Fonts are the baseline bundled fonts of `text-and-titles.Font loading`. Every value is
editable after the layout is applied.

| id | Name | Layers (text role: x, y, size, weight, fill, extras) |
|---|---|---|
| `cv-title-bottom` | Title bar | title: 0.50, 0.84, 0.090, 700, `#FFFFFF`, background `#000000` at 60 % opacity, padding 0.02 |
| `cv-title-center` | Centre title | title: 0.50, 0.50, 0.120, 800, `#FFFFFF`, stroke `#000000` width 0.006 |
| `cv-title-sub` | Title and subtitle | title: 0.50, 0.42, 0.100, 800, `#FFFFFF`, shadow `#000000` blur 0.01; subtitle: 0.50, 0.56, 0.050, 500, `#FFD60A` |
| `cv-corner-tag` | Corner tag | tag: 0.14, 0.10, 0.045, 700, `#000000`, background `#FFD60A`, padding 0.012, corner radius 0.01 |
| `cv-episode` | Episode | label: 0.50, 0.14, 0.045, 600, `#FFFFFF`, letter spacing 0.2 em; title: 0.50, 0.80, 0.085, 800, `#FFFFFF`, stroke `#000000` width 0.005 |
| `cv-big-number` | Big number | number: 0.18, 0.50, 0.320, 900, `#FF5D8F`, stroke `#FFFFFF` width 0.008; title: 0.62, 0.50, 0.070, 700, `#FFFFFF` |
